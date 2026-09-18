program p
  type :: t
    character(len=:), allocatable :: name
  end type
  type(t), allocatable :: b(:)
  allocate(b(2))
  b(1)%name = "hello"
  b(2)%name = "world"
  print *, "P8 OK ", b(1)%name, " ", b(2)%name
end program
